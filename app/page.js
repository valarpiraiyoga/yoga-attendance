import AppShell from "@/components/layout/AppShell";
import Container from "@/components/layout/Container";
import PageHeader from "@/components/layout/PageHeader";
import { requireUser } from "@/lib/auth/dal";

export default async function Home() {
  // Authorization boundary — the proxy is only a first-pass check.
  const user = await requireUser();

  return (
    <AppShell role={user.role} user={user}>
      <Container>
        {/* Temporary scaffold. The real Dashboard is a later phase. */}
        <PageHeader title="Dashboard" description="Application shell preview." />
      </Container>
    </AppShell>
  );
}
