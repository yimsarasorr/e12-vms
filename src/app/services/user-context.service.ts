import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class UserContextService {
  private currentProfileId = '';
  private currentProfileIdSubject = new BehaviorSubject<string>('');

  currentProfileId$ = this.currentProfileIdSubject.asObservable();

  setCurrentProfileId(id: string) {
    this.currentProfileId = id;
    this.currentProfileIdSubject.next(id);
    console.log('Current Profile ID set:', this.currentProfileId);
  }

  getCurrentProfileId(): string {
    return this.currentProfileId;
  }
}
