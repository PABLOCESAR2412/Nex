import { createFileRoute } from "@tanstack/react-router";
import { LibraryPage } from "../components/studio-pages";

export const Route = createFileRoute("/biblioteca")({ component: LibraryPage });
