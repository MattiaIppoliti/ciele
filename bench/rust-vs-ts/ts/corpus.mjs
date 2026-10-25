// Deterministic corpus shared by both sides: the same Flows and messages,
// so a difference in output is a porting bug, not a different input.
import { writeFileSync } from "node:fs";

let seed = 1111;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (list) => list[Math.floor(rand() * list.length)];

const topics = [
  ["Password reset", "User cannot log in or wants to reset their password", ["password", "login", "accedere", "credenziali"]],
  ["Billing", "Questions about payments, invoices and due dates", ["invoice", "pagamento", "fattura", "billing"]],
  ["Meeting rooms", "Booking meeting rooms and shared spaces", ["room", "sala", "orari", "booking"]],
  ["Appointments", "Booking, cancelling or moving an appointment", ["appointment", "appuntamento", "slot", "prenotazione"]],
  ["Wi-Fi access", "Connecting to the office network or the VPN", ["wifi", "network", "rete", "vpn"]],
  ["Contracts", "Signing, renewing or ending a contract", ["contract", "contratto", "rinnovo", "disdetta"]],
  ["Discounts", "Promotions, vouchers and loyalty discounts", ["sconto", "voucher", "coupon", "promo"]],
  ["Shipping status", "Where is my order, tracking and delivery delays", ["order", "spedizione", "tracking", "consegna"]],
  ["Refunds", "Returns, refunds and cancellations of a purchase", ["refund", "rimborso", "reso", "annullare"]],
  ["Opening hours", "When the office or store is open", ["open", "aperto", "orario", "chiusura"]],
  ["Human help needed", "The user explicitly asks for a person", []],
  ["Assistant information", "Who the assistant is and what it can do", []],
];
const flows = topics.map(([name, description, words], i) => ({
  id: `flow-${i}`,
  name,
  description,
  enabled: i !== 7,
  isDefault: false,
  trigger: "message",
  position: (i * 7) % topics.length,
  conditionLogic: i % 3 === 0 ? "all" : "any",
  conditions: words.length === 0 ? [] : [
    {
      kind: "conversation_context",
      description: `Conversations about ${words.join(", ")}`,
      examples: [
        { message: `come faccio con ${words[1]}`, shouldTrigger: true },
        { message: `I have a problem with ${words[0]}`, shouldTrigger: true },
        { message: `non riguarda ${words[2]}`, shouldTrigger: false },
      ],
    },
  ],
  actions: [],
}));
flows.push({ id: "flow-default", name: "Default behavior", description: "", enabled: true, isDefault: true, trigger: "message", position: 999, conditions: [], actions: [] });

const fillers = ["Ciao!", "Hello,", "Buongiorno", "Hi there", "Scusate,", "Excuse me —", "Salve…", "Hey 👋"];
const asks = [
  "how do I", "come posso", "I can't", "non riesco a", "vorrei sapere", "can you tell me", "where is", "qual è",
  "è possibile", "is it possible to", "who are you", "talk to a human", "parlare con un operatore", "cosa puoi fare",
];
const extras = ["per favore", "please!!", "grazie mille.", "asap?", "(urgente)", "— thanks", "😊", "Città, società e perché?", "naïve café résumé", "ÉTÉ Ångström"];
const messages = [];
for (let i = 0; i < 5000; i++) {
  const words = pick(topics)[2];
  const parts = [pick(fillers), pick(asks), words.length ? pick(words) : "", pick(extras)];
  if (rand() < 0.3) parts.push(pick(asks), pick(pick(topics)[2]) ?? "");
  messages.push(parts.join(" "));
}
writeFileSync(new URL("../corpus.json", import.meta.url), JSON.stringify({ flows, messages }));
console.log(`corpus: ${flows.length} flows, ${messages.length} messages`);
