package mn.haruulzangi.u18_2026.my_vault

import android.app.Application
import android.util.Log
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

class FlagViewModel(application: Application) : AndroidViewModel(application) {
    private val repository = FlagRepository(
        context = application.applicationContext,
        crypto = KeyStoreCrypto(),
        handshakeClient = HandshakeClient(BuildConfig.FLAG_SERVER_URL),
    )

    private val _state = MutableStateFlow(FlagLoadState())
    val state: StateFlow<FlagLoadState> = _state.asStateFlow()

    init {
        refreshDeviceState()
    }

    fun loadFlag() {
        if (
            _state.value.loading ||
            _state.value.saved ||
            _state.value.rootDetected ||
            _state.value.developerModeEnabled ||
            _state.value.adbEnabled
        ) {
            return
        }

        viewModelScope.launch {
            _state.value = FlagLoadState(loading = true)
            runCatching {
                if (repository.isDeveloperModeEnabled()) {
                    throw DeveloperModeEnabledException()
                }
                if (repository.isAdbEnabled()) {
                    throw AdbEnabledException()
                }
                if (repository.isDeviceRooted()) {
                    throw RootDetectedException()
                }
                repository.retrieveDecryptAndSaveFlag()
            }.onSuccess {
                _state.value = FlagLoadState(saved = true)
            }.onFailure { error ->
                Log.e(TAG, "Flag load failed", error)
                _state.update {
                    FlagLoadState(
                        rootDetected = error is RootDetectedException,
                        developerModeEnabled = error is DeveloperModeEnabledException,
                        adbEnabled = error is AdbEnabledException,
                        deviceNotSecure = error is DeviceNotSecureException,
                        error = error.message ?: "Flag load failed",
                    )
                }
            }
        }
    }

    private fun refreshDeviceState() {
        viewModelScope.launch {
            runCatching {
                DeviceState(
                    hasSavedFlag = repository.hasSavedFlag(),
                    developerModeEnabled = repository.isDeveloperModeEnabled(),
                    adbEnabled = repository.isAdbEnabled(),
                    rootDetected = repository.isDeviceRooted(),
                )
            }.onSuccess { deviceState ->
                _state.value = FlagLoadState(
                    saved = deviceState.hasSavedFlag,
                    developerModeEnabled = deviceState.developerModeEnabled,
                    adbEnabled = deviceState.adbEnabled,
                    rootDetected = deviceState.rootDetected,
                    error = when {
                        deviceState.developerModeEnabled -> DeveloperModeEnabledException().message
                        deviceState.adbEnabled -> AdbEnabledException().message
                        deviceState.rootDetected -> RootDetectedException().message
                        else -> null
                    },
                )
            }.onFailure { error ->
                Log.e(TAG, "Device state check failed", error)
                _state.update {
                    FlagLoadState(error = error.message ?: "Device state check failed")
                }
            }
        }
    }

    private companion object {
        const val TAG = "FlagViewModel"
    }
}

data class FlagLoadState(
    val loading: Boolean = false,
    val saved: Boolean = false,
    val rootDetected: Boolean = false,
    val developerModeEnabled: Boolean = false,
    val adbEnabled: Boolean = false,
    val deviceNotSecure: Boolean = false,
    val error: String? = null,
)

private data class DeviceState(
    val hasSavedFlag: Boolean,
    val developerModeEnabled: Boolean,
    val adbEnabled: Boolean,
    val rootDetected: Boolean,
)
