import { createFileRoute } from "@tanstack/react-router";
import { DeploymentsPage } from "../components/studio-pages";

export const Route = createFileRoute("/despliegues")({ component: DeploymentsPage });
