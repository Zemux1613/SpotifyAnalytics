import { Component, computed, effect, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '@shared/services/auth.service';
import { pickImage } from './core/images';
import { InspectorService } from '@shared/services/inspector.service';
import { NowPlayingService } from '@shared/services/now-playing.service';
import { ThemeService } from '@shared/services/theme.service';
import { InspectorComponent } from './shared/components/inspector/inspector.component';
import { NowPlayingComponent } from './shared/components/now-playing/now-playing.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, InspectorComponent, NowPlayingComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  protected readonly auth = inject(AuthService);
  protected readonly inspector = inject(InspectorService);
  protected readonly playback = inject(NowPlayingService);
  protected readonly themeService = inject(ThemeService); 
  protected readonly avatar = computed(() => pickImage(this.auth.user()?.images, 64));

  constructor() {
    effect(() => {
      if (this.auth.user()) {
        this.playback.start();
      } else {
        this.inspector.clear();
        this.playback.reset();
      }
    });
  }
}