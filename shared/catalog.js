export const patterns = [
  'Arrays & Hashing',
  'Two Pointers',
  'Sliding Window',
  'Stack',
  'Binary Search',
  'Linked List',
  'Trees',
  'Graphs',
  'Dynamic Programming',
];

export const languageOptions = [
  { id: 'python-3.14', label: 'Python', editor: 'python' },
  { id: 'g++-15', label: 'C++', editor: 'cpp' },
  { id: 'openjdk-25', label: 'Java', editor: 'java' },
  { id: 'typescript-deno', label: 'TypeScript', editor: 'typescript' },
];

// Editor templates only. All problem statements and tests come from MongoDB.
export const starterCode = {
  'python-3.14':
    'import sys\n\ndef solve():\n    data = sys.stdin.read().split()\n    # Write your solution here.\n    pass\n\nsolve()\n',
  'g++-15':
    '#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n\n    // Write your solution here.\n    return 0;\n}\n',
  'openjdk-25':
    'import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner in = new Scanner(System.in);\n        // Write your solution here.\n    }\n}\n',
  'typescript-deno':
    'const input = await new Response(Deno.stdin.readable).text();\nconst tokens = input.trim().split(/\\s+/);\n\n// Write your solution here.\n',
};
