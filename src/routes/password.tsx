import { createFileRoute } from "@tanstack/react-router";
import { PasswordChangePage } from "../components/password-change-page";

export const Route = createFileRoute("/password")({ component: PasswordChangePage });
