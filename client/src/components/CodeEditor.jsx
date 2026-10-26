import { useMemo } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { java } from '@codemirror/lang-java'
import { cpp } from '@codemirror/lang-cpp'
import { oneDark } from '@codemirror/theme-one-dark'

export default function CodeEditor({ value, onChange, language, readOnly = false, height = '440px' }) {
  const extensions = useMemo(() => {
    if (language === 'python') return [python()]
    if (language === 'java') return [java()]
    if (language === 'javascript') return [javascript()]
    return [cpp()]
  }, [language])

  return (
    <div className="editor-code" aria-label={readOnly ? 'Submitted source code' : 'Code editor'}>
      <CodeMirror
        value={value}
        height={height}
        theme={oneDark}
        extensions={extensions}
        onChange={onChange}
        readOnly={readOnly}
        editable={!readOnly}
        aria-label={readOnly ? 'Submitted source code' : 'Code editor'}
        basicSetup={{ foldGutter: true, highlightActiveLine: !readOnly, autocompletion: !readOnly }}
      />
    </div>
  )
}
