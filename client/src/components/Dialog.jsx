import { useEffect, useId, useRef } from 'react'
import { X } from 'lucide-react'
import './Dialog.css'

export default function Dialog({ title, children, onClose, busy = false, fallbackFocusRef }) {
  const dialogRef = useRef(null)
  const headingRef = useRef(null)
  const pointerStartedOutside = useRef(false)
  const titleId = useId()

  useEffect(() => {
    const dialog = dialogRef.current
    const opener = document.activeElement
    const previousOverflow = document.body.style.overflow
    dialog.showModal()
    headingRef.current.focus()
    document.body.style.overflow = 'hidden'
    return () => {
      dialog.close()
      document.body.style.overflow = previousOverflow
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
      else fallbackFocusRef?.current?.focus()
    }
  }, [fallbackFocusRef])

  useEffect(() => { headingRef.current.focus() }, [title])

  function close() { if (!busy) onClose() }

  function isOutside(event) {
    if (event.target !== event.currentTarget) return false
    const bounds = event.currentTarget.getBoundingClientRect()
    return event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom
  }

  function handleKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    }
    if (event.key !== 'Tab') return
    const focusable = [...dialogRef.current.querySelectorAll('button, a[href], input, select, textarea, [tabindex="0"]')]
      .filter((element) => !element.matches(':disabled') && !element.closest('[hidden]'))
    const first = focusable[0]
    const last = focusable.at(-1)
    if (!first) { event.preventDefault(); headingRef.current.focus(); return }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === headingRef.current)) {
      event.preventDefault(); last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus()
    }
  }

  return <dialog ref={dialogRef} className="app-dialog" aria-labelledby={titleId} aria-modal="true" aria-busy={busy}
    onCancel={(event) => { event.preventDefault(); close() }} onKeyDown={handleKeyDown}
    onPointerDown={(event) => { pointerStartedOutside.current = isOutside(event) }}
    onClick={(event) => { if (pointerStartedOutside.current && isOutside(event)) close(); pointerStartedOutside.current = false }}>
    <div className="app-dialog-header"><h2 id={titleId} tabIndex={-1} ref={headingRef}>{title}</h2><button type="button" className="app-dialog-close" aria-label="Close dialog" onClick={close} disabled={busy}><X size={20} /></button></div>
    <div className="app-dialog-content">{children}</div>
  </dialog>
}
