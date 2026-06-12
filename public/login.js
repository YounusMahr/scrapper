// Redirect immediately if user is already authenticated
const checkSession = () => {
  const token = localStorage.getItem('scrapper_session_token');
  if (token) {
    window.location.href = '/';
  }
};
checkSession();

/**
 * Initialize Google Sign-In button and prompt One Tap
 */
window.onload = function () {
  google.accounts.id.initialize({
    client_id: "359359481405-cbuspr0m3klfs7grkbd6pba5vf4ij24f.apps.googleusercontent.com",
    callback: handleCredentialResponse
  });
  
  google.accounts.id.renderButton(
    document.getElementById("google-signin-btn"),
    { 
      theme: "filled_blue", 
      size: "large", 
      width: "320", 
      text: "signin_with",
      shape: "rectangular"
    }
  );
  
  // Display Google One Tap dialog
  google.accounts.id.prompt();
};

/**
 * Handle Google Token postback and session verification
 */
async function handleCredentialResponse(response) {
  try {
    console.log('[Auth] Google token received, verifying with server...');
    
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ credential: response.credential })
    });
    
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'OAuth token verification failed');
    }
    
    const data = await res.json();
    
    // Persist session locally
    localStorage.setItem('scrapper_session_token', data.token);
    localStorage.setItem('scrapper_user', JSON.stringify(data.user));
    
    console.log(`[Auth] Verification successful. Welcome ${data.user.name}!`);
    
    // Redirect to dashboard
    window.location.href = '/';
  } catch (err) {
    console.error('[Auth Error]', err);
    alert(`Authentication Error: ${err.message}`);
  }
}
