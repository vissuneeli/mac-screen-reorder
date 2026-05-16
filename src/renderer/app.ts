import { DisplayManager } from './services/display-manager';
import { RecordingService } from './services/recording-service';
import { StatusView } from './ui/status-view';
import { UIController } from './ui/ui-controller';

window.addEventListener('DOMContentLoaded', async () => {
  const api = window.electronAPI;

  const displayManager = new DisplayManager(api);
  const recordingService = new RecordingService(api, displayManager);

  const statusView = new StatusView(
    document.getElementById('status-text')!,
    document.getElementById('timer')!,
    document.getElementById('countdown')!,
  );

  const controller = new UIController(recordingService, displayManager, statusView, api);
  await controller.init();
});
