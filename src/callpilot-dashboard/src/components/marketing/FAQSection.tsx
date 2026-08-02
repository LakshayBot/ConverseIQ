import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const FAQ = [
  {
    q: "Does audio ever leave my machine?",
    a: "In the desktop client, transcription runs locally with Parakeet — the raw audio doesn't leave the machine by default. Intelligence is served from your own self-hosted instance.",
  },
  {
    q: "Which LLM providers are supported?",
    a: "DeepSeek, Ollama, OpenAI, Claude and Gemini — bring your own key, or point the synthesis step at a local model.",
  },
  {
    q: "What CRMs does it integrate with?",
    a: "HubSpot and Salesforce sync, so calls and notes land where your team already works.",
  },
  {
    q: "Can I self-host the whole thing?",
    a: "Yes — the platform ships as Docker Compose with PostgreSQL + pgvector and Redis. Nothing requires a third-party cloud.",
  },
  {
    q: "What file types can I upload to the knowledge bank?",
    a: "PDF, DOCX, Markdown and plain text. Structured mode runs layout-aware extraction with Docling, then LLM enrichment.",
  },
  {
    q: "Is this open source?",
    a: "Yes — MIT-licensed on GitHub, including the server, AI engine, dashboard and desktop client.",
  },
];

export function FAQSection() {
  return (
    <section id="faq" className="section">
      <div className="landing-container">
        <div className="section-head">
          <p className="section-eyebrow">08 — Questions</p>
          <h2 className="section-title">Asked in every evaluation</h2>
        </div>

        <div className="max-w-3xl">
          <Accordion type="single" collapsible>
            {FAQ.map((item, i) => (
              <AccordionItem key={item.q} value={`item-${i}`}>
                <AccordionTrigger className="font-display text-[17px] font-semibold tracking-[-0.01em]">
                  {item.q}
                </AccordionTrigger>
                <AccordionContent className="text-[15px] leading-relaxed">
                  {item.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </div>
    </section>
  );
}
