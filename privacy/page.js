export const metadata = { title: "Privacy Policy — PSA Ranking Planner" };
export default function Privacy(){
  return (
    <main style={{ maxWidth: "70ch", margin: "0 auto", padding: "40px 20px", lineHeight: 1.6 }}>
      <h1>Privacy Policy</h1>
      <p><em>Last updated: 8 September 2026</em></p>
      <p>PSA Ranking Planner ("the planner") is a tool that helps professional squash players decide which tournaments to enter. This page explains what data it keeps and why.</p>
      <h2>What we collect</h2>
      <p>When you sign in with Google we receive your name, e-mail address and Google account identifier. We use them only to identify your account and show your own data to you. We do not receive your Google password and we do not read anything else in your Google account.</p>
      <p>While you use the planner we store what you enter: tournament results, planned entries, expected results, home region and related settings. This data exists so the planner can do its calculations and remember them between visits.</p>
      <h2>How it is used and shared</h2>
      <p>Your data is used solely to run the planner for you. It is not sold, not used for advertising and not shared with third parties, except the service providers that host the application (Vercel) and its database (Supabase), who process it on our behalf.</p>
      <p>Administrators of the planner can see player profiles in order to maintain the shared tournament schedule and rankings and to help with support.</p>
      <h2>Retention and deletion</h2>
      <p>Your data is kept for as long as your account exists. You can delete your player profile at any time from the Settings tab. To delete your account entirely, or to ask what data we hold about you, e-mail <a href="mailto:yppollak@gmail.com">yppollak@gmail.com</a>.</p>
      <h2>Google user data</h2>
      <p>Use of information received from Google APIs adheres to the <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including the Limited Use requirements.</p>
      <p><a href="/">Back to the planner</a></p>
    </main>
  );
}
