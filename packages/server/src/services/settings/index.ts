// TODO: add settings

import { Platform } from '../../Interface'
import { getRunningExpressApp } from '../../utils/getRunningExpressApp'

const getSettings = async () => {
    try {
        const appServer = getRunningExpressApp()
        const platformType = appServer.identityManager.getPlatformType()

        // VibeFlow: expose the fork UI profile and module/network policy to the frontend.
        const vibeflowSettings = {
            VIBEFLOW_UI_PROFILE: process.env.VIBEFLOW_UI_PROFILE || 'vibeflow',
            VIBEFLOW_UNRESTRICTED_MODULES: process.env.VIBEFLOW_UNRESTRICTED_MODULES !== 'false',
            VIBEFLOW_UNRESTRICTED_NETWORK: process.env.VIBEFLOW_UNRESTRICTED_NETWORK !== 'false'
        }

        switch (platformType) {
            case Platform.ENTERPRISE: {
                if (!appServer.identityManager.isLicenseValid()) {
                    return { ...vibeflowSettings }
                } else {
                    return { PLATFORM_TYPE: Platform.ENTERPRISE, ...vibeflowSettings }
                }
            }
            case Platform.CLOUD: {
                return { PLATFORM_TYPE: Platform.CLOUD, ...vibeflowSettings }
            }
            default: {
                return { PLATFORM_TYPE: Platform.OPEN_SOURCE, ...vibeflowSettings }
            }
        }
    } catch (error) {
        return {}
    }
}

export default {
    getSettings
}
