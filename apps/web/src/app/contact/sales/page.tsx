import type { Metadata } from "next";
import { ContactSales } from "@/components/contact/contact-sales";

export const metadata: Metadata = {
  title: "Contact Sales | Ciele",
  description: "Talk to the Ciele team about AI assistants for your organization.",
};

export default function ContactSalesPage() {
  return <ContactSales />;
}
