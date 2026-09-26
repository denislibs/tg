/** @jsxImportSource solid-js */
// Порт tweb/src/components/sidebarLeft/tabs/autoDownload/photo.tsx:1-6 (812502980) 1:1.
import autoDownloadTab from './autoDownloadTab.solid'
import { autoDownloadPeerTypeSection } from './peerTypeSection.solid'

export default autoDownloadTab((tab) => {
  tab.scrollable.append(autoDownloadPeerTypeSection('photo', 'AutoDownloadPhotosTitle', tab.middlewareHelper.get()))
})
