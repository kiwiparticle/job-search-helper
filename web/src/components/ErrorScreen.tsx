// The route errorElement: a component that throws lands here instead of on a blank page.
export function ErrorScreen() {
    return (
        <main className="page">
            <h1>Something on this screen broke</h1>
            <p className="sub">The rest of your data is fine. Reloading usually clears it.</p>
            <button type="button" onClick={() => window.location.reload()}>Reload</button>
        </main>
    );
}
