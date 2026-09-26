interface QuestionsToAskProps {
  questions: string[];
}

export default function QuestionsToAsk({ questions }: QuestionsToAskProps) {
  if (questions.length === 0) return null;
  return (
    <section aria-labelledby="questions-title">
      <h2 className="section-title" id="questions-title">
        Questions to ask before signing
      </h2>
      <ol className="questions-list">
        {questions.map((q, i) => (
          <li key={i}>{q}</li>
        ))}
      </ol>
    </section>
  );
}
