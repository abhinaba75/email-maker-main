declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(config: GoogleTokenClientConfig): GoogleTokenClient;
        };
      };
    };
  }
}

export interface GoogleTokenClientConfig {
  client_id: string;
  scope: string;
  prompt?: string;
  callback: (response: GoogleTokenResponse) => void;
  error_callback?: (error: GoogleTokenError) => void;
}

export interface GoogleTokenClient {
  requestAccessToken(options?: { prompt?: string }): void;
}

export interface GoogleTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

export interface GoogleTokenError {
  type?: string;
  message?: string;
}

export {};
