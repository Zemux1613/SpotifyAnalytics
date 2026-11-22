import { Component, inject } from '@angular/core';
import { InspectorService } from '@shared/services/inspector.service';
import { NowPlayingService } from '../../services/now-playing.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-now-playing',
  templateUrl: './now-playing.component.html',
  styleUrl: './now-playing.component.scss',
})
export class NowPlayingComponent {
  protected readonly inspector = inject(InspectorService);
  protected readonly playback = inject(NowPlayingService);
  protected readonly auth = inject(AuthService);

  protected openInspector(): void {
    const track = this.playback.displayTrack();
    if (track) {
      this.inspector.show(track);
    }
  }

  protected dismissSelection(): void {
    this.playback.unpin();
    this.inspector.close();
  }
}
