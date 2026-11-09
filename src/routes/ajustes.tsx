import { createFileRoute } from "@tanstack/react-router";
import { SettingsPage } from "../components/studio-pages";

export const Route = createFileRoute("/ajustes")({ component: SettingsPage });
