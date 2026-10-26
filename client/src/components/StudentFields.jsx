import { departments } from '../departments'

export default function StudentFields({ values, onChange }) {
  return (
    <>
      <label>
        Full name
        <input
          name="name"
          autoComplete="name"
          maxLength={100}
          value={values.name}
          onChange={onChange}
          required
          placeholder="Your full name"
        />
      </label>
      <div className="field-row">
        <label>
          Department
          <select
            name="department"
            value={values.department}
            onChange={onChange}
            required
          >
            <option value="">Select department</option>
            {departments.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Year
          <select name="year" value={values.year} onChange={onChange} required>
            <option value="">Select year</option>
            {['1st', '2nd', '3rd', '4th'].map((year) => (
              <option key={year} value={year}>
                {year} year
              </option>
            ))}
          </select>
        </label>
      </div>
    </>
  )
}
