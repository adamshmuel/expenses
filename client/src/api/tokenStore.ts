// The access token lives in memory only — never in localStorage, so a script
// injected into the page cannot read it. It is lost on refresh, and the app
// asks /users/refresh for a new one when it starts.

let accessToken: string | null = null

export const getAccessToken = () => accessToken

export const setStoredAccessToken = (token: string | null) => {
  accessToken = token
}
