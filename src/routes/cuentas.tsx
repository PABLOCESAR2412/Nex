import { createFileRoute } from "@tanstack/react-router";
import { AccountsPage } from "../components/studio-pages";

export const Route = createFileRoute("/cuentas")({ component: AccountsPage });
