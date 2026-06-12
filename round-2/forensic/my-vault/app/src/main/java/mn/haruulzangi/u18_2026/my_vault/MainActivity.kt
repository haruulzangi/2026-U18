package mn.haruulzangi.u18_2026.my_vault

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Block
import androidx.compose.material.icons.filled.BugReport
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Security
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ContainedLoadingIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MediumFlexibleTopAppBar
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import mn.haruulzangi.u18_2026.my_vault.ui.theme.MyVaultTheme

class MainActivity : ComponentActivity() {
    private val viewModel: FlagViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            MyVaultTheme {
                val state by viewModel.state.collectAsStateWithLifecycle()
                VaultScreen(
                    state = state,
                    onLoadFlag = viewModel::loadFlag,
                )
            }
        }
    }
}

private enum class StatusKind { Idle, Loading, Saved, Blocked, Error }

private data class StatusUi(
    val kind: StatusKind,
    val icon: ImageVector,
    val title: String,
    val message: String,
    val buttonLabel: String,
    val buttonEnabled: Boolean,
    val accent: Color,
    val onAccent: Color,
    val container: Color,
    val onContainer: Color,
)

@Composable
private fun VaultScreen(
    state: FlagLoadState,
    onLoadFlag: () -> Unit,
) {
    val ui = rememberStatusUi(state)
    val scrollBehavior = TopAppBarDefaults.exitUntilCollapsedScrollBehavior()

    Scaffold(
        modifier = Modifier
            .fillMaxSize()
            .nestedScroll(scrollBehavior.nestedScrollConnection),
        containerColor = MaterialTheme.colorScheme.surface,
        contentWindowInsets = WindowInsets.statusBars,
        topBar = {
            MediumFlexibleTopAppBar(
                title = {
                    Text(
                        text = stringResource(R.string.app_name),
                        style = MaterialTheme.typography.headlineMediumEmphasized,
                    )
                },
                scrollBehavior = scrollBehavior,
            )
        },
    ) { padding ->
        VaultContent(
            ui = ui,
            state = state,
            onLoadFlag = onLoadFlag,
            contentPadding = padding,
        )
    }
}

@Composable
private fun VaultContent(
    ui: StatusUi,
    state: FlagLoadState,
    onLoadFlag: () -> Unit,
    contentPadding: PaddingValues,
) {
    val motion = MaterialTheme.motionScheme

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(contentPadding)
            .padding(horizontal = 24.dp, vertical = 16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(24.dp),
    ) {
        Spacer(Modifier.height(8.dp))

        StatusBadge(ui = ui, loading = state.loading)

        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = MaterialTheme.shapes.extraLarge,
            colors = CardDefaults.cardColors(
                containerColor = ui.container,
                contentColor = ui.onContainer,
            ),
            elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 24.dp, vertical = 28.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                AnimatedContent(
                    targetState = ui.title,
                    transitionSpec = {
                        fadeIn(motion.defaultEffectsSpec()) togetherWith
                            fadeOut(motion.defaultEffectsSpec())
                    },
                    label = "status-title",
                ) { title ->
                    Text(
                        text = title,
                        style = MaterialTheme.typography.headlineSmallEmphasized,
                        fontWeight = FontWeight.SemiBold,
                        textAlign = TextAlign.Center,
                    )
                }
                AnimatedContent(
                    targetState = ui.message,
                    transitionSpec = {
                        fadeIn(motion.defaultEffectsSpec()) togetherWith
                            fadeOut(motion.defaultEffectsSpec())
                    },
                    label = "status-message",
                ) { message ->
                    Text(
                        text = message,
                        style = MaterialTheme.typography.bodyLarge,
                        textAlign = TextAlign.Center,
                    )
                }
            }
        }

        Button(
            onClick = onLoadFlag,
            enabled = ui.buttonEnabled,
            modifier = Modifier
                .fillMaxWidth()
                .height(72.dp),
            shapes = ButtonDefaults.shapes(),
            colors = ButtonDefaults.buttonColors(
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary,
            ),
        ) {
            if (state.loading) {
                LoadingIndicator(
                    modifier = Modifier.size(28.dp),
                    color = MaterialTheme.colorScheme.onPrimary,
                )
                Spacer(Modifier.size(12.dp))
            } else {
                Icon(
                    imageVector = ui.icon,
                    contentDescription = null,
                    modifier = Modifier.size(ButtonDefaults.IconSize),
                )
                Spacer(Modifier.size(ButtonDefaults.IconSpacing))
            }
            Text(
                text = ui.buttonLabel,
                style = MaterialTheme.typography.titleMediumEmphasized,
            )
        }
    }
}

@Composable
private fun StatusBadge(ui: StatusUi, loading: Boolean) {
    if (loading) {
        ContainedLoadingIndicator(
            modifier = Modifier.size(112.dp),
            containerColor = ui.accent,
            indicatorColor = ui.onAccent,
        )
    } else {
        Surface(
            shape = CircleShape,
            color = ui.accent,
            contentColor = ui.onAccent,
            modifier = Modifier.size(112.dp),
        ) {
            Box(contentAlignment = Alignment.Center) {
                Icon(
                    imageVector = ui.icon,
                    contentDescription = null,
                    modifier = Modifier.size(56.dp),
                )
            }
        }
    }
}

@Composable
private fun rememberStatusUi(state: FlagLoadState): StatusUi {
    val context = LocalContext.current
    val scheme = MaterialTheme.colorScheme

    val kind = when {
        state.loading -> StatusKind.Loading
        state.rootDetected || state.developerModeEnabled || state.adbEnabled ||
            state.deviceNotSecure -> StatusKind.Blocked
        state.saved -> StatusKind.Saved
        state.error != null -> StatusKind.Error
        else -> StatusKind.Idle
    }

    return when (kind) {
        StatusKind.Idle -> StatusUi(
            kind = kind,
            icon = Icons.Filled.Lock,
            title = context.getString(R.string.idle_title),
            message = context.getString(R.string.idle_message),
            buttonLabel = context.getString(R.string.load_flag),
            buttonEnabled = true,
            accent = scheme.primaryContainer,
            onAccent = scheme.onPrimaryContainer,
            container = scheme.surfaceContainerHigh,
            onContainer = scheme.onSurface,
        )
        StatusKind.Loading -> StatusUi(
            kind = kind,
            icon = Icons.Filled.Lock,
            title = context.getString(R.string.loading_flag),
            message = context.getString(R.string.loading_message),
            buttonLabel = context.getString(R.string.loading_flag),
            buttonEnabled = false,
            accent = scheme.primaryContainer,
            onAccent = scheme.onPrimaryContainer,
            container = scheme.surfaceContainerHigh,
            onContainer = scheme.onSurface,
        )
        StatusKind.Saved -> StatusUi(
            kind = kind,
            icon = Icons.Filled.CheckCircle,
            title = context.getString(R.string.flag_saved),
            message = context.getString(R.string.flag_saved_message),
            buttonLabel = context.getString(R.string.flag_saved),
            buttonEnabled = false,
            accent = scheme.tertiaryContainer,
            onAccent = scheme.onTertiaryContainer,
            container = scheme.tertiaryContainer,
            onContainer = scheme.onTertiaryContainer,
        )
        StatusKind.Blocked -> {
            val (icon, title, message, buttonLabel) = when {
                state.developerModeEnabled -> Quad(
                    Icons.Filled.BugReport,
                    context.getString(R.string.developer_mode_button),
                    context.getString(R.string.developer_mode_message),
                    context.getString(R.string.developer_mode_button),
                )
                state.adbEnabled -> Quad(
                    Icons.Filled.Warning,
                    context.getString(R.string.adb_enabled_button),
                    context.getString(R.string.adb_enabled_message),
                    context.getString(R.string.adb_enabled_button),
                )
                state.deviceNotSecure -> Quad(
                    Icons.Filled.Block,
                    context.getString(R.string.device_not_secure_button),
                    context.getString(R.string.device_not_secure_message),
                    context.getString(R.string.device_not_secure_button),
                )
                else -> Quad(
                    Icons.Filled.Block,
                    context.getString(R.string.root_detected_button),
                    context.getString(R.string.root_detected_message),
                    context.getString(R.string.root_detected_button),
                )
            }
            StatusUi(
                kind = kind,
                icon = icon,
                title = title,
                message = message,
                buttonLabel = buttonLabel,
                buttonEnabled = false,
                accent = scheme.errorContainer,
                onAccent = scheme.onErrorContainer,
                container = scheme.errorContainer,
                onContainer = scheme.onErrorContainer,
            )
        }
        StatusKind.Error -> StatusUi(
            kind = kind,
            icon = Icons.Filled.Security,
            title = context.getString(R.string.error_title),
            message = context.getString(R.string.flag_load_error, state.error.orEmpty()),
            buttonLabel = context.getString(R.string.retry),
            buttonEnabled = true,
            accent = scheme.errorContainer,
            onAccent = scheme.onErrorContainer,
            container = scheme.errorContainer,
            onContainer = scheme.onErrorContainer,
        )
    }
}

private data class Quad<A, B, C, D>(val a: A, val b: B, val c: C, val d: D)

@Preview(showBackground = true)
@Composable
private fun VaultScreenIdlePreview() {
    MyVaultTheme {
        VaultScreen(state = FlagLoadState(), onLoadFlag = {})
    }
}

@Preview(showBackground = true)
@Composable
private fun VaultScreenSavedPreview() {
    MyVaultTheme {
        VaultScreen(state = FlagLoadState(saved = true), onLoadFlag = {})
    }
}

@Preview(showBackground = true)
@Composable
private fun VaultScreenBlockedPreview() {
    MyVaultTheme {
        VaultScreen(state = FlagLoadState(rootDetected = true), onLoadFlag = {})
    }
}
