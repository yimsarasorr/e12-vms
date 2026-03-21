// src/app/components/joystick/joystick.component.ts
import { Component, ElementRef, HostListener, ViewChild, inject, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PlayerControlsService } from '../../services/floorplan/player-controls.service';

@Component({
  selector: 'app-joystick',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './joystick.component.html',
  styleUrls: ['./joystick.component.css']
})
export class JoystickComponent {
  @ViewChild('base') private baseRef!: ElementRef<HTMLDivElement>;
  @ViewChild('stick') private stickRef!: ElementRef<HTMLDivElement>;

  private playerControls = inject(PlayerControlsService);
  private ngZone = inject(NgZone);

  private activePointerId: number | null = null;
  private baseRadius = 0;
  private stickRadius = 0;
  private maxMove = 0;
  private readonly stickPadding = 6;
  private isDragging = false;

  private get baseEl(): HTMLDivElement {
    return this.baseRef.nativeElement;
  }

  private get stickEl(): HTMLDivElement {
    return this.stickRef.nativeElement;
  }

  // --- 1. เมื่อเริ่มกด (เมาส์ หรือ สัมผัส) ---
  onPointerDown(event: PointerEvent): void {
    // ป้องกันพฤติกรรมเริ่มต้น (เช่น การลากรูป)
    event.preventDefault();
    event.stopPropagation();
    this.isDragging = true;
    this.activePointerId = event.pointerId;

    this.recalculateBounds();

    try {
      this.baseEl.setPointerCapture(event.pointerId);
    } catch {
      // Ignore capture errors (บาง Browser อาจไม่รองรับ)
    }

    // รันนอก Angular Zone เพื่อ performance ที่ดีขึ้น
    this.ngZone.runOutsideAngular(() => {
      this.updateStickPosition(event.clientX, event.clientY);
    });
  }

  // --- 2. เมื่อลาก (จะถูกจับโดย HostListener) ---
  @HostListener('window:pointermove', ['$event'])
  onPointerMove(event: PointerEvent): void {
    if (!this.isDragging || event.pointerId !== this.activePointerId) return;

    this.ngZone.runOutsideAngular(() => {
      this.updateStickPosition(event.clientX, event.clientY);
    });
  }

  // --- 3. เมื่อปล่อย (จะถูกจับโดย HostListener) ---
  @HostListener('window:pointerup', ['$event'])
  onPointerUp(event: PointerEvent): void {
    if (!this.isDragging || event.pointerId !== this.activePointerId) return;

    this.isDragging = false;
    this.releasePointerCapture(event.pointerId);
    this.resetStick();
  }

  @HostListener('window:pointercancel', ['$event'])
  onPointerCancel(event: PointerEvent): void {
    if (!this.isDragging || event.pointerId !== this.activePointerId) return;

    this.isDragging = false;
    this.releasePointerCapture(event.pointerId);
    this.resetStick();
  }

  private updateStickPosition(clientX: number, clientY: number): void {
    const baseRect = this.baseEl.getBoundingClientRect();
    const baseCenterX = baseRect.left + baseRect.width / 2;
    const baseCenterY = baseRect.top + baseRect.height / 2;

    let deltaX = clientX - baseCenterX;
    let deltaY = clientY - baseCenterY;

    // จำกัดระยะการลากให้อยู่ในวงกลม
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    const maxMove = this.maxMove || Math.max(0, baseRect.width / 2 - this.stickEl.offsetWidth / 2 - this.stickPadding);

    if (maxMove <= 0) {
      return;
    }

    if (distance > maxMove) {
      deltaX = (deltaX / distance) * maxMove;
      deltaY = (deltaY / distance) * maxMove;
    }

    // ขยับตัว Stick (UI)
    this.stickEl.style.transform = `translate(${deltaX}px, ${deltaY}px)`;

    // คำนวณ Vector (-1 ถึง 1) แล้วส่งไปให้ Player
    // เรากลับแกน Y เพราะใน 3D (Z) แกนบวกคือ "เดินหน้า" แต่ใน CSS/DOM แกน Y บวกคือ "ลงล่าง"
    const vectorX = deltaX / maxMove;
    const vectorY = -deltaY / maxMove;

    // ส่งค่าไปให้ Service ที่เรา Refactor ไว้
    this.playerControls.setJoystickInput(vectorX, vectorY);
  }

  private recalculateBounds(): void {
    const baseRect = this.baseEl.getBoundingClientRect();
    const stickRect = this.stickEl.getBoundingClientRect();

    this.baseRadius = baseRect.width / 2;
    this.stickRadius = stickRect.width / 2;
    this.maxMove = Math.max(0, this.baseRadius - this.stickRadius - this.stickPadding);
  }

  private releasePointerCapture(pointerId: number): void {
    const baseEl = this.baseRef?.nativeElement;
    if (!baseEl) return;

    try {
      if ((baseEl as any).hasPointerCapture?.(pointerId)) {
        baseEl.releasePointerCapture(pointerId);
      }
    } catch {
      // Ignore errors when releasing pointer capture
    }
  }

  private resetStick(): void {
    this.activePointerId = null;
    this.stickEl.style.transform = 'translate(0px, 0px)';
    this.playerControls.setJoystickInput(0, 0);
  }
}
