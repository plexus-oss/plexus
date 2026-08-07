import { PageWrapper } from "@/components/ui/page-wrapper";
import { TerminalConversation } from "@/components/assistant/terminal-conversation";

export default function TerminalPage() {
  return (
    <PageWrapper
      title="Terminal"
      description="Create alerts, dashboards, sources, and connections — in plain language."
    >
      <TerminalConversation variant="page" />
    </PageWrapper>
  );
}
