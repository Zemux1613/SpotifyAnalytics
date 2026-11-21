import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { AuthService } from '@shared/services/auth.service';

const ERRORS: Record<string, string> = {
  access_denied: 'Die Anmeldung wurde abgebrochen. Ohne deine Freigabe kann ich keine Top-Listen laden.',
};
const DEFAULT_ERROR = 'Die Anmeldung bei Spotify hat nicht geklappt. Bitte versuche es noch einmal.';

@Component({
  selector: 'app-login-page',
  templateUrl: './login.component.html',
})
export class LoginComponent {
  private readonly auth = inject(AuthService);
  private readonly code = inject(ActivatedRoute).snapshot.queryParamMap.get('error');

  protected readonly error = this.code ? (ERRORS[this.code] ?? DEFAULT_ERROR) : null;

  protected login(): void {
    this.auth.login();
  }
}
