import type { InputHTMLAttributes } from 'react'
import { AlertIcon } from './icons'

interface FormFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string
  label: string
  /** A message from the server or from our own checks. Undefined means "fine". */
  error?: string
  /** Grey text under the input, shown only while there is no error. */
  hint?: string
}

/**
 * One labelled input plus its error message.
 *
 * `aria-invalid` and `aria-describedby` are what connect the message to the
 * input for screen readers — without them the red text is only visible to
 * people who can see it.
 */
export const FormField = ({ id, label, error, hint, ...inputProps }: FormFieldProps) => {
  const messageId = `${id}-message`

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? messageId : undefined}
        className={error ? 'input input--invalid' : 'input'}
        {...inputProps}
      />
      {error ? (
        <span id={messageId} className="field__error">
          <AlertIcon />
          {error}
        </span>
      ) : hint ? (
        <span id={messageId} className="field__hint">
          {hint}
        </span>
      ) : null}
    </div>
  )
}
