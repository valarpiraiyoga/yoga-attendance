import AppShell from "@/components/layout/AppShell";
import Container from "@/components/layout/Container";
import PageHeader from "@/components/layout/PageHeader";

export default function Home() {
  return (
    <AppShell>
      <Container>
        <PageHeader title="Dashboard" description="Application shell preview." />
      </Container>
    </AppShell>
  );
}
