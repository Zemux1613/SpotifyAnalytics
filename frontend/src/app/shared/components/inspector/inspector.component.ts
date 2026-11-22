import { Component, HostListener, inject } from '@angular/core';
import { InspectorService } from '@shared/services/inspector.service';
import { TrackDetailsComponent } from '../track-details/track-details.component';
import { PlaylistSuggestionsComponent } from '../playlist-suggestions/playlist-suggestions.component';

@Component({
  selector: 'app-inspector',
  imports: [TrackDetailsComponent, PlaylistSuggestionsComponent],
  templateUrl: './inspector.component.html',
  styleUrl: './inspector.component.scss',
})
export class InspectorComponent {
  protected readonly inspector = inject(InspectorService);

  @HostListener('document:keydown.escape')
  protected closeOnEscape(): void {
    if (this.inspector.isOpen()) {
      this.inspector.close();
    }
  }
}
