import { createFileRoute } from "@tanstack/react-router";
import { CalendarPage } from "../components/studio-pages";

export const Route = createFileRoute("/calendario")({ component: CalendarPage });
