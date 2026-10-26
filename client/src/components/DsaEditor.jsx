const examples = {
  cpp: { starter: 'class Solution {\npublic:\n    int add(int a, int b) {\n        // Return the sum.\n        return 0;\n    }\n};', prefix: '#include <bits/stdc++.h>\nusing namespace std;', suffix: 'int main() {\n    int a, b;\n    cin >> a >> b;\n    cout << Solution().add(a, b) << "\\n";\n}' },
  python: { starter: 'class Solution:\n    def add(self, a, b):\n        return 0', prefix: 'import sys', suffix: 'a, b = map(int, sys.stdin.read().split())\nprint(Solution().add(a, b))' },
  java: { starter: 'class Solution {\n    public int add(int a, int b) {\n        return 0;\n    }\n}', prefix: 'import java.util.*;\nclass Main {\n    public static void main(String[] args) {\n        Scanner in = new Scanner(System.in);\n        System.out.println(new Solution().add(in.nextInt(), in.nextInt()));\n    }\n}', suffix: '' },
  javascript: { starter: 'function add(a, b) {\n    return 0;\n}', prefix: '', suffix: "const [a, b] = require('fs').readFileSync(0, 'utf8').trim().split(/\\s+/).map(Number);\nconsole.log(add(a, b));" },
  c: { starter: 'int add(int a, int b) {\n    return 0;\n}', prefix: '#include <stdio.h>', suffix: 'int main(void) {\n    int a, b;\n    scanf("%d %d", &a, &b);\n    printf("%d\\n", add(a, b));\n    return 0;\n}' },
}
const labels = { cpp: 'C++', python: 'Python', java: 'Java', javascript: 'JavaScript', c: 'C' }

export default function DsaEditor({ value = [], onChange, locked }) {
  function update(index, field, content) {
    onChange(value.map((item, i) => i === index ? { ...item, [field]: content } : item))
  }
  return <section className="admin-form-section">
    <div className="admin-section-heading"><h3>Function templates</h3></div>
    <p className="admin-subtle">Add at least one supported language. Students write only the function; the hidden driver reads test input, calls the function and prints its result.</p>
    {!locked && <div className="admin-actions">{Object.entries(labels).filter(([language]) => !value.some(item => item.language === language)).map(([language, label]) => <button key={language} type="button" className="secondary-button" onClick={() => onChange([...value, { language, ...examples[language] }])}>Add {label}</button>)}</div>}
    {!value.length && <p className="admin-subtle">Add a language before publishing.</p>}
    {value.map((config, index) => <div className="admin-example" key={config.language}>
      <div className="admin-section-heading"><h4>{labels[config.language]}</h4>{!locked && <button type="button" className="text-button" onClick={() => onChange(value.filter((_, i) => i !== index))}>Remove {labels[config.language]}</button>}</div>
      <p className="admin-subtle">The initial example adds two integers. Adapt the function signature and driver to this problem before publishing.</p>
      <label>{labels[config.language]} function template<textarea required className="admin-code" rows={7} value={config.starter} onChange={event => update(index, 'starter', event.target.value)} /></label>
      <details><summary>Hidden driver</summary>
        <label>{labels[config.language]} prefix (headers and helpers)<textarea className="admin-code" rows={4} value={config.prefix} onChange={event => update(index, 'prefix', event.target.value)} /></label>
        <label>{labels[config.language]} suffix (read input, call function, print result)<textarea className="admin-code" rows={7} value={config.suffix} onChange={event => update(index, 'suffix', event.target.value)} /></label>
      </details>
    </div>)}
  </section>
}
