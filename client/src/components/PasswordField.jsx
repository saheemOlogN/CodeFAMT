import { useId, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

export default function PasswordField({
  label = 'Password',
  name = 'password',
  value,
  onChange,
  newPassword = false,
}) {
  const [visible, setVisible] = useState(false)
  const id = useId()
  return (
    <div className="password-control">
      <label htmlFor={id}>{label}</label>
      <span className="password-field">
        <input
          id={id}
          name={name}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          autoComplete={newPassword ? 'new-password' : 'current-password'}
          minLength={newPassword ? 8 : undefined}
          required
          placeholder={
            newPassword ? 'At least 8 characters' : 'Enter your password'
          }
        />
        <button
          type="button"
          onClick={() => setVisible(!visible)}
          aria-label={
            visible
              ? `Hide ${label.toLowerCase()}`
              : `Show ${label.toLowerCase()}`
          }
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </span>
    </div>
  )
}
