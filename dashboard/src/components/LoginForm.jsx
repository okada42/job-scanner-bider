import { memo } from "react";

export const LoginForm = memo(function LoginForm({ login, error, onLoginChange, onSubmit }) {
  return (
    <div className="login-wrap">
      <form className="card login" onSubmit={onSubmit}>
        <h1>Job Scanner</h1>
        <p>Enter the backend API token.</p>
        <input value={login} onChange={(e) => onLoginChange(e.target.value)} placeholder="API_TOKEN" />
        <button type="submit">Sign in</button>
        {error && <p className="err">{error}</p>}
      </form>
    </div>
  );
});
