import { marketingMetadata } from "@/lib/marketing/seo";
import { ContactSales } from "@/components/contact/contact-sales";

export const metadata = marketingMetadata({
  title: "Contact Sales | Ciele",
  description: "Talk to the Ciele team about AI assistants for your organization.",
  path: "/contact/sales",
});

export default function ContactSalesPage() {
  return <ContactSales />;
}
