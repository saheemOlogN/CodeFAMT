export default function TestCaseFields({ title, cases, onChange, maximum }) {
  function update(index, field, value) {
    onChange(cases.map((test, i) => (i === index ? { ...test, [field]: value } : test)));
  }

  return (
    <section className="test-fields">
      <h3>{title}</h3>
      {cases.map((test, index) => (
        <div className="test-fields" key={index}>
          <div className="test-fields-heading">
            <span>Case {index + 1}</span>
            <button
              type="button"
              className="text-button"
              disabled={cases.length === 1}
              onClick={() => onChange(cases.filter((_, i) => i !== index))}
            >
              Remove
            </button>
          </div>
          <label>
            Input
            <textarea
              rows={3}
              maxLength={10000}
              value={test.input}
              onChange={(event) => update(index, 'input', event.target.value)}
            />
          </label>
          <label>
            Expected output
            <textarea
              rows={2}
              maxLength={998}
              value={test.output}
              onChange={(event) => update(index, 'output', event.target.value)}
            />
          </label>
        </div>
      ))}
      <button
        type="button"
        className="button secondary"
        disabled={cases.length >= maximum}
        onClick={() => onChange([...cases, { input: '', output: '' }])}
      >
        Add test case
      </button>
      <span className="small-text muted">Expected output: up to 998 characters per case.</span>
    </section>
  );
}
