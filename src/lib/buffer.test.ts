// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBufferVideoPost, getBufferChannels, getBufferPost, type BufferChannel } from "./buffer";

const apiKey = "test-buffer-token";
const organizationId = "authorized-org";
const videoUrl = "https://nex.example/api/social/buffer/media/test-grant";
const caption = "Título de la pieza\n\nDescripción para el video";
const channel: BufferChannel = {
  id: "tiktok-first",
  name: "@primera",
  service: "tiktok",
  type: "profile",
  isLocked: false,
  isDisconnected: false,
  hasActiveMemberDevice: true,
  defaultToReminders: false,
};
const post = {
  id: "buffer-post-1",
  channelId: channel.id,
  status: "sending",
  schedulingType: "automatic",
  notificationStatus: null,
  externalLink: null,
};

function useFetch() {
  const request = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", request);
  return request;
}

function graphData(data: unknown) {
  return Response.json({ data });
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("Buffer channel authorization", () => {
  it("only returns Instagram and TikTok accounts in the authorized organization", async () => {
    const request = useFetch();
    const { defaultToReminders: _, ...base } = channel;
    request
      .mockResolvedValueOnce(graphData({ account: { organizations: [{ id: organizationId }] } }))
      .mockResolvedValueOnce(graphData({ channels: [
        { ...base, organizationId, metadata: { defaultToReminders: true } },
        { ...base, organizationId, metadata: null, id: "instagram-second", service: "instagram", isDisconnected: true },
        { ...base, organizationId, metadata: {}, id: "excluded", service: "youtube" },
      ] }));

    await expect(getBufferChannels(apiKey, organizationId)).resolves.toEqual([
      { ...channel, defaultToReminders: true },
      { ...channel, id: "instagram-second", service: "instagram", isDisconnected: true },
    ]);
    expect(request.mock.calls[1][0]).toBe("https://api.buffer.com");
    expect(request.mock.calls[1][1]?.headers).toMatchObject({ authorization: `Bearer ${apiKey}` });
    expect(JSON.parse(String(request.mock.calls[1][1]?.body))).toMatchObject({ variables: { organizationId } });
  });

  it("does not ask for channels in an organization absent from the authorized account", async () => {
    const request = useFetch().mockResolvedValueOnce(graphData({ account: { organizations: [{ id: "another-org" }] } }));
    await expect(getBufferChannels(apiKey, organizationId)).rejects.toMatchObject({ code: "organization", definitive: true });
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe("Buffer video publishing", () => {
  it("creates a TikTok video using the chosen channel, URL and full caption, then checks the exact post", async () => {
    const request = useFetch()
      .mockResolvedValueOnce(graphData({ createPost: { __typename: "PostActionSuccess", post } }))
      .mockResolvedValueOnce(graphData({ post: { ...post, status: "sent", externalLink: "https://www.tiktok.com/@primera/video/123" } }));

    await expect(createBufferVideoPost(apiKey, { channel, caption, videoUrl })).resolves.toEqual(post);
    expect(JSON.parse(String(request.mock.calls[0][1]?.body)).variables).toEqual({ input: {
      channelId: channel.id,
      mode: "shareNow",
      schedulingType: "automatic",
      text: caption,
      assets: [{ video: { url: videoUrl } }],
    } });
    await expect(getBufferPost(apiKey, post.id)).resolves.toMatchObject({ status: "sent", channelId: channel.id, externalLink: "https://www.tiktok.com/@primera/video/123" });
    expect(JSON.parse(String(request.mock.calls[1][1]?.body))).toMatchObject({
      query: expect.stringContaining("post(input: { id: $id })"), variables: { id: post.id },
    });
  });

  it("sends a Reel reminder for an Instagram personal profile and preserves notification status", async () => {
    const instagram: BufferChannel = { ...channel, id: "instagram-personal", service: "instagram" };
    const request = useFetch().mockResolvedValueOnce(graphData({
      createPost: { __typename: "PostActionSuccess", post: { ...post, channelId: instagram.id, status: "sent", schedulingType: null, notificationStatus: "notified" } },
    }));
    await expect(createBufferVideoPost(apiKey, { channel: instagram, caption, videoUrl })).resolves.toMatchObject({
      schedulingType: "notification", status: "sent", notificationStatus: "notified",
    });
    expect(JSON.parse(String(request.mock.calls[0][1]?.body)).variables.input).toMatchObject({
      schedulingType: "notification", metadata: { instagram: { type: "reel" } },
    });
  });

  it("differentiates a rejected mutation from a failure with unknown outcome", async () => {
    useFetch()
      .mockResolvedValueOnce(graphData({ createPost: { __typename: "InvalidInputError", message: `Could not load ${videoUrl}` } }))
      .mockResolvedValueOnce(graphData({ createPost: { __typename: "UnexpectedError" } }))
      .mockResolvedValueOnce(graphData({ createPost: { __typename: "PostActionSuccess", post: { ...post, channelId: "unrelated-channel" } } }))
      .mockRejectedValueOnce(new Error(`Could not load ${videoUrl}`));
    const input = { channel, caption, videoUrl };

    await expect(createBufferVideoPost(apiKey, input)).rejects.toMatchObject({
      definitive: true, code: "invalid_input", message: expect.not.stringContaining(videoUrl),
    });
    await expect(createBufferVideoPost(apiKey, input)).rejects.toMatchObject({ definitive: false, code: "unknown" });
    await expect(createBufferVideoPost(apiKey, input)).rejects.toMatchObject({ definitive: false, code: "unknown" });
    await expect(createBufferVideoPost(apiKey, input)).rejects.toMatchObject({
      definitive: false, code: "unavailable", message: expect.not.stringContaining(videoUrl),
    });
  });

  it("blocks unusable channels before sending a request and rejects a mismatched retrieved post", async () => {
    const request = useFetch().mockResolvedValueOnce(graphData({ post: { ...post, id: "another-post" } }));
    await expect(createBufferVideoPost(apiKey, { channel: { ...channel, isLocked: true }, caption, videoUrl }))
      .rejects.toMatchObject({ definitive: true, code: "unavailable_channel" });
    await expect(createBufferVideoPost(apiKey, { channel: { ...channel, defaultToReminders: true, hasActiveMemberDevice: false }, caption, videoUrl }))
      .rejects.toMatchObject({ definitive: true, code: "notification_device" });
    expect(request).not.toHaveBeenCalled();
    await expect(getBufferPost(apiKey, post.id)).rejects.toMatchObject({ definitive: false, code: "unknown" });
  });
});
