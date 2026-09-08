/**
 * The one loud thing on the auth screens: a worked example of what the app
 * does. A sentence goes in, priced line items come out, and they add up.
 *
 * It is decorative in the sense that it is not interactive, but it is real
 * content — it is the clearest possible explanation of the product, so it is
 * left readable rather than hidden from screen readers.
 */

interface Line {
  store: string
  category: string
  amount: string
}

const lines: Line[] = [
  { store: 'Supermarket', category: 'Groceries', amount: '50.00' },
  { store: 'Gas station', category: 'Fuel', amount: '32.00' },
]

export const LedgerSlip = () => (
  <aside className="ledger">
    <div className="ledger__inner">
      <p className="ledger__said">“spent 50 at the supermarket and 32 on gas”</p>

      <div className="slip">
        <ol className="slip__lines">
          {lines.map((line, index) => (
            <li key={line.store} className="slip__line" style={{ '--step': index } as React.CSSProperties}>
              <span className="slip__store">{line.store}</span>
              <span className="slip__leader" aria-hidden="true" />
              <span className="slip__category">{line.category}</span>
              <span className="slip__amount">{line.amount}</span>
            </li>
          ))}
        </ol>

        <p className="slip__total" style={{ '--step': lines.length } as React.CSSProperties}>
          <span>Total</span>
          <span className="slip__leader" aria-hidden="true" />
          <span className="slip__amount">₪ 82.00</span>
        </p>
      </div>

      <p className="ledger__note">Write it the way you would say it. The app files it.</p>
    </div>
  </aside>
)
