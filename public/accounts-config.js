/* Trading Journal Accounts API configuration.
   The API URL is public. Each signed-in Firebase user connects their own Myfxbook
   profile inside Accounts; plaintext Myfxbook credentials are not stored here.
*/
window.TJ_ACCOUNTS_CONFIG = Object.assign({
  apiUrl: 'https://trading-journal-accounts-proxy.vercel.app/api/myfxbook'
}, window.TJ_ACCOUNTS_CONFIG || {});
