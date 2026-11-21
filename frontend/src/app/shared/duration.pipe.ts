import { Pipe, PipeTransform } from '@angular/core';
import { formatDuration } from './format';

@Pipe({ name: 'duration' })
export class DurationPipe implements PipeTransform {
  transform(ms: number | null | undefined): string {
    return formatDuration(ms);
  }
}
