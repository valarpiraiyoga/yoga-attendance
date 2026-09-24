import Container from "@/components/layout/Container";

/**
 * Add Student (and its guided steps) keeps the standard 1200px content
 * container. The Students layout above no longer supplies it, because the list
 * page draws a full-width header strip outside the container.
 */
export default function NewStudentLayout({ children }) {
  return <Container>{children}</Container>;
}
