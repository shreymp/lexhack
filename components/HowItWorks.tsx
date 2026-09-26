const STEPS = [
  {
    title: "Share your lease",
    body: "Upload a PDF or paste the text. Nothing is saved on our servers.",
  },
  {
    title: "We check it against Chicago law",
    body: "Each clause is compared to the Chicago RLTO and to protections it requires.",
  },
  {
    title: "See what's flagged, and why",
    body: "Every flag shows the exact wording from your lease and the law behind it.",
  },
];

export default function HowItWorks() {
  return (
    <section aria-labelledby="how-it-works-title">
      <h2 className="section-title" id="how-it-works-title">
        How it works
      </h2>
      <ol className="steps">
        {STEPS.map((step, i) => (
          <li className="step" key={step.title}>
            <span className="step__num" aria-hidden="true">
              {i + 1}
            </span>
            <h3>{step.title}</h3>
            <p>{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
