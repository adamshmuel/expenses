import type { ReactElement, ReactNode } from 'react'
import { render } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router-dom'
import { makeStore } from '../store/store'

/**
 * Renders a component the way the real app does: inside the Redux store and a
 * router. `route` is the URL the test starts on.
 */
export const renderWithProviders = (ui: ReactElement, route = '/') => {
  const store = makeStore()
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>
      <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
    </Provider>
  )
  return { store, ...render(ui, { wrapper: Wrapper }) }
}
