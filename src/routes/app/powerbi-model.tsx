import { createFileRoute } from "@tanstack/react-router";
import { SimplePowerBiModelPage } from "@/components/migration/SimplePowerBiModelPage";

export const Route = createFileRoute("/app/powerbi-model")({ component: SimplePowerBiModelPage });
