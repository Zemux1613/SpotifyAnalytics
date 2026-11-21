import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';
import { AuthService } from '@shared/services/auth.service';

/** Lässt nur eingeloggte User durch, alle anderen landen auf /login. */
export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.loadUser().pipe(map((user) => (user ? true : router.createUrlTree(['/login']))));
};

/** Die Login-Seite ist nur für Gäste, wer schon eingeloggt ist, kommt direkt zu den Top-Listen. */
export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.loadUser().pipe(map((user) => (user ? router.createUrlTree(['/dashboard']) : true)));
};
