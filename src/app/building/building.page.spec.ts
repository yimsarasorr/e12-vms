import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BuildingPage } from './building.page';

describe('Tab4Page', () => {
  let component: BuildingPage;
  let fixture: ComponentFixture<BuildingPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(BuildingPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
