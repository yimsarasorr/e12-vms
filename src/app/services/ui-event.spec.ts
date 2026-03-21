import { TestBed } from '@angular/core/testing';

import { UiEvent } from './ui-event';

describe('UiEvent', () => {
  let service: UiEvent;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(UiEvent);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
