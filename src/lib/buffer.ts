import { z } from "zod/v4";

const apiUrl = "https://api.buffer.com";
const timeoutMs = 8_000;

const channelSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  name: z.string().min(1),
  service: z.string(),
  type: z.string(),
  isLocked: z.boolean(),
  isDisconnected: z.boolean(),
  hasActiveMemberDevice: z.boolean(),
  metadata: z.object({ defaultToReminders: z.boolean().optional() }).nullable(),
});

export type BufferChannel = Omit<z.infer<typeof channelSchema>, "organizationId" | "metadata" | "service"> & {
  service: "instagram" | "tiktok";
  defaultToReminders: boolean;
};

const postSchema = z.object({
  id: z.string().min(1),
  channelId: z.string().min(1),
  status: z.string().min(1),
  schedulingType: z.enum(["automatic", "notification"]).nullable(),
  notificationStatus: z.string().nullable(),
  externalLink: z.string().nullable(),
});

export type BufferPost = z.infer<typeof postSchema>;

const messages = {
  authorization: "Buffer rechazó la autorización. Revisa la clave y sus permisos.",
  organization: "La organización seleccionada no está disponible con esta clave de Buffer.",
  unavailable_channel: "El canal de Buffer está desconectado o bloqueado.",
  notification_device: "Configura las notificaciones en la app móvil de Buffer para publicar en este canal.",
  invalid_video_url: "Buffer requiere una URL HTTPS para descargar el video.",
  rate_limit: "Buffer limitó las solicitudes. Espera un momento y reintenta.",
  invalid_input: "Buffer rechazó los datos de la publicación. Revisa el formato del video y el texto.",
  limit: "Buffer alcanzó el límite de publicaciones del canal.",
  not_found: "Buffer no encontró el destino solicitado.",
  unavailable: "No se pudo contactar con Buffer.",
  unknown: "Buffer no confirmó el resultado de la solicitud.",
};

export class BufferApiError extends Error {
  constructor(readonly code: keyof typeof messages, readonly definitive: boolean) {
    super(messages[code]);
    this.name = "BufferApiError";
  }
}

async function requestBuffer(apiKey: string, query: string, variables: Record<string, unknown> = {}) {
  let response: Response;
  try {
    response = await fetch(apiUrl, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new BufferApiError("unavailable", false);
  }

  if (response.status === 401 || response.status === 403) throw new BufferApiError("authorization", true);
  if (response.status === 429) throw new BufferApiError("rate_limit", true);
  if (!response.ok) throw new BufferApiError("unknown", false);

  const payload = await response.json().catch(() => null) as { data?: unknown; errors?: unknown } | null;
  if (!payload?.data || (Array.isArray(payload.errors) && payload.errors.length > 0)) throw new BufferApiError("unknown", false);
  return payload.data;
}

export async function getBufferChannels(apiKey: string, organizationId: string): Promise<BufferChannel[]> {
  const authorization = await requestBuffer(apiKey, "query NexBufferOrganizations { account { organizations { id } } }");
  const organizations = z.object({ account: z.object({ organizations: z.array(z.object({ id: z.string() })) }) }).safeParse(authorization);
  if (!organizations.success) throw new BufferApiError("unknown", false);
  if (!organizations.data.account.organizations.some(({ id }) => id === organizationId)) throw new BufferApiError("organization", true);

  const response = await requestBuffer(apiKey, `query NexBufferChannels($organizationId: OrganizationId!) {
    channels(input: { organizationId: $organizationId }) {
      id organizationId name service type isLocked isDisconnected hasActiveMemberDevice
      metadata {
        ... on InstagramMetadata { defaultToReminders }
        ... on TiktokMetadata { defaultToReminders }
      }
    }
  }`, { organizationId });
  const parsed = z.object({ channels: z.array(channelSchema) }).safeParse(response);
  if (!parsed.success || parsed.data.channels.some((channel) => channel.organizationId !== organizationId)) {
    throw new BufferApiError("unknown", false);
  }
  return parsed.data.channels.flatMap(({ service, metadata, organizationId: _, ...channel }) =>
    service === "instagram" || service === "tiktok" ? [{ ...channel, service, defaultToReminders: metadata?.defaultToReminders ?? false }] : [],
  );
}

const postFields = "id channelId status schedulingType notificationStatus externalLink";

function httpsUrl(value: string | null) {
  try {
    if (!value) return null;
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

function safePost(post: BufferPost): BufferPost {
  return { ...post, externalLink: httpsUrl(post.externalLink) };
}

export async function createBufferVideoPost(
  apiKey: string,
  { channel, caption, videoUrl }: { channel: BufferChannel; caption: string; videoUrl: string },
): Promise<BufferPost> {
  if (channel.isLocked || channel.isDisconnected) throw new BufferApiError("unavailable_channel", true);
  const url = httpsUrl(videoUrl);
  if (!url) throw new BufferApiError("invalid_video_url", true);
  const isInstagram = channel.service === "instagram";
  const notification = channel.defaultToReminders || (isInstagram && channel.type === "profile");
  if (notification && !channel.hasActiveMemberDevice) throw new BufferApiError("notification_device", true);
  const schedulingType = notification ? "notification" : "automatic";
  const response = await requestBuffer(apiKey, `mutation NexBufferCreateVideo($input: CreatePostInput!) {
    createPost(input: $input) {
      __typename
      ... on PostActionSuccess { post { ${postFields} } }
    }
  }`, {
    input: {
      channelId: channel.id,
      text: caption,
      mode: "shareNow",
      schedulingType,
      assets: [{ video: { url } }],
      ...(isInstagram ? { metadata: { instagram: { type: "reel", shouldShareToFeed: true } } } : {}),
    },
  });
  const result = z.object({ createPost: z.object({ __typename: z.string(), post: z.unknown().optional() }) }).safeParse(response);
  if (!result.success) throw new BufferApiError("unknown", false);

  const { __typename, post } = result.data.createPost;
  if (__typename === "UnauthorizedError") throw new BufferApiError("authorization", true);
  if (__typename === "InvalidInputError") throw new BufferApiError("invalid_input", true);
  if (__typename === "LimitReachedError") throw new BufferApiError("limit", true);
  if (__typename === "NotFoundError") throw new BufferApiError("not_found", true);

  const parsed = postSchema.safeParse(post);
  if (__typename !== "PostActionSuccess" || !parsed.success || parsed.data.channelId !== channel.id) {
    throw new BufferApiError("unknown", false);
  }
  return safePost({ ...parsed.data, schedulingType: parsed.data.schedulingType ?? schedulingType });
}

export async function getBufferPost(apiKey: string, postId: string): Promise<BufferPost> {
  const response = await requestBuffer(apiKey, `query NexBufferPost($id: PostId!) {
    post(input: { id: $id }) { ${postFields} }
  }`, { id: postId });
  const parsed = z.object({ post: postSchema }).safeParse(response);
  if (!parsed.success || parsed.data.post.id !== postId) throw new BufferApiError("unknown", false);
  return safePost(parsed.data.post);
}
