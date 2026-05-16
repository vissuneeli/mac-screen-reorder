import { DisplayInfo } from '../types';

interface DisplayAPI {
  getDisplays(): Promise<DisplayInfo[]>;
  getDesktopSources(): Promise<Array<{ id: string; name: string; display_id: string }>>;
}

export class DisplayManager {
  private displays: DisplayInfo[] = [];
  private selectedId: string | null = null;

  constructor(private api: DisplayAPI) {}

  async load(): Promise<DisplayInfo[]> {
    this.displays = await this.api.getDisplays();
    if (this.displays.length > 0 && !this.selectedId) {
      this.selectedId = this.displays[0].id;
    }
    return this.displays;
  }

  select(id: string): void {
    this.selectedId = id;
  }

  getSelected(): DisplayInfo | null {
    return this.displays.find(d => d.id === this.selectedId) ?? null;
  }

  getAll(): DisplayInfo[] {
    return this.displays;
  }

  async getDesktopSourceId(displayId: string): Promise<string | null> {
    const sources = await this.api.getDesktopSources();
    const numericId = displayId.split(':')[1] ?? null;
    const match = sources.find(s => numericId !== null && s.display_id === numericId) ?? sources[0];
    return match?.id ?? null;
  }
}
