/**
 * How a document's status is shown in the register: the same two badges the document page uses (Issued in the success style,
 * Cancelled in the danger style). Presentation only - the status is the stored `invoices.status`.
 */
export const DOCUMENT_STATUS = {
  issued: { label: "Issued", variant: "success" },
  cancelled: { label: "Cancelled", variant: "danger" },
};
