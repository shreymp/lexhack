const POINTS = [
  {
    title: "It cites the law, or it says nothing.",
    body: "We only call a clause “likely unenforceable” when we can point to the specific law it conflicts with. Otherwise we flag it as one-sided at most, or leave it alone.",
  },
  {
    title: "Every highlighted quote is checked against your lease.",
    body: "Before anything is shown to you, we confirm the exact wording appears in your lease. Quotes that don't match are thrown out.",
  },
  {
    title: "It tells you what's missing.",
    body: "Chicago law requires some things to be in a lease. We check for those too, and tell you when we can't find them.",
  },
];

export default function TrustPoints() {
  return (
    <section aria-labelledby="trust-title">
      <h2 className="section-title" id="trust-title">
        Why you can trust it
      </h2>
      <ul className="trust-list">
        {POINTS.map((point) => (
          <li className="trust-item" key={point.title}>
            <span className="trust-item__icon" aria-hidden="true">
              &#10003;
            </span>
            <p>
              <strong>{point.title}</strong>
              <br />
              {point.body}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
